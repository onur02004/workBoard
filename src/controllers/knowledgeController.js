const pool = require("../config/database");

const NODE_TYPES = new Set(["workspace", "project", "area", "topic", "system"]);
const RELATION_TYPES = new Set(["related", "depends_on", "contains", "references"]);
const plain = value => value && typeof value === "object" && !Array.isArray(value);

exports.list = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*,
        b.title AS board_title,
        (SELECT COUNT(*)::int FROM knowledge_nodes child WHERE child.parent_id=n.id) AS child_count,
        (SELECT COUNT(*)::int FROM knowledge_node_items ni WHERE ni.node_id=n.id) AS item_count
      FROM knowledge_nodes n
      LEFT JOIN boards b ON b.id=n.board_id
      ORDER BY n.position,n.created_at,n.title
    `);
    const relations = await pool.query(`
      SELECT r.*, s.title AS source_title, t.title AS target_title
      FROM knowledge_node_relations r
      JOIN knowledge_nodes s ON s.id=r.source_node_id
      JOIN knowledge_nodes t ON t.id=r.target_node_id
      ORDER BY r.created_at
    `);
    res.json({ nodes: result.rows, relations: relations.rows });
  } catch (e) {
    console.error("KNOWLEDGE LIST:", e);
    res.status(500).json({ message: "Knowledge scope could not be loaded", error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { title, description = null, node_type = "area", parent_id = null,
      board_id = null, color = "#5793f7", position = 0, properties = {} } = req.body;
    if (typeof title !== "string" || !title.trim()) return res.status(400).json({ message: "Title is required" });
    if (!NODE_TYPES.has(node_type)) return res.status(400).json({ message: "Invalid node_type" });
    if (!plain(properties)) return res.status(400).json({ message: "properties must be an object" });
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ message: "color must be a hex colour" });
    if (parent_id) {
      const parent = await pool.query("SELECT id FROM knowledge_nodes WHERE id=$1", [parent_id]);
      if (!parent.rowCount) return res.status(400).json({ message: "Parent scope not found" });
    }
    if (board_id) {
      const board = await pool.query("SELECT id FROM boards WHERE id=$1", [board_id]);
      if (!board.rowCount) return res.status(400).json({ message: "Linked board not found" });
    }
    const result = await pool.query(`
      INSERT INTO knowledge_nodes(title,description,node_type,parent_id,board_id,color,position,properties)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *
    `, [title.trim(), description, node_type, parent_id, board_id, color,
      Number.isInteger(position) ? position : 0, JSON.stringify(properties)]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error("KNOWLEDGE CREATE:", e);
    res.status(500).json({ message: "Scope could not be created", error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const allowed = new Set(["title","description","node_type","parent_id","board_id","color","position","properties"]);
    const sets = [], values = [];
    for (const [key, value] of Object.entries(req.body)) {
      if (!allowed.has(key)) continue;
      if (key === "title" && (typeof value !== "string" || !value.trim())) return res.status(400).json({ message: "Title cannot be empty" });
      if (key === "node_type" && !NODE_TYPES.has(value)) return res.status(400).json({ message: "Invalid node_type" });
      if (key === "color" && !/^#[0-9a-fA-F]{6}$/.test(value)) return res.status(400).json({ message: "color must be a hex colour" });
      if (key === "properties" && !plain(value)) return res.status(400).json({ message: "properties must be an object" });
      if (key === "parent_id" && value) {
        if (value === req.params.id) return res.status(400).json({ message: "A scope cannot be its own parent" });
        const check = await pool.query(`
          WITH RECURSIVE descendants AS (
            SELECT id FROM knowledge_nodes WHERE parent_id=$1
            UNION ALL SELECT n.id FROM knowledge_nodes n JOIN descendants d ON n.parent_id=d.id
          ) SELECT id FROM descendants WHERE id=$2 LIMIT 1
        `, [req.params.id, value]);
        if (check.rowCount) return res.status(400).json({ message: "Cannot move a scope inside its own descendant" });
      }
      values.push(key === "properties" ? JSON.stringify(value) : key === "title" ? value.trim() : value);
      sets.push(`${key}=$${values.length}${key === "properties" ? "::jsonb" : ""}`);
    }
    if (!sets.length) return res.status(400).json({ message: "No valid fields supplied" });
    values.push(req.params.id);
    const result = await pool.query(`UPDATE knowledge_nodes SET ${sets.join(",")} WHERE id=$${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ message: "Scope not found" });
    res.json(result.rows[0]);
  } catch (e) {
    console.error("KNOWLEDGE UPDATE:", e);
    res.status(500).json({ message: "Scope could not be updated", error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM knowledge_nodes WHERE id=$1 RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: "Scope not found" });
    res.json({ deleted: true });
  } catch (e) {
    console.error("KNOWLEDGE DELETE:", e);
    res.status(500).json({ message: "Scope could not be deleted", error: e.message });
  }
};

exports.addRelation = async (req, res) => {
  try {
    const { target_node_id, relation_type = "related" } = req.body;
    if (!target_node_id || target_node_id === req.params.id) return res.status(400).json({ message: "Choose another scope" });
    if (!RELATION_TYPES.has(relation_type)) return res.status(400).json({ message: "Invalid relation type" });
    const result = await pool.query(`
      INSERT INTO knowledge_node_relations(source_node_id,target_node_id,relation_type)
      VALUES($1,$2,$3)
      ON CONFLICT(source_node_id,target_node_id,relation_type) DO UPDATE SET relation_type=EXCLUDED.relation_type
      RETURNING *
    `, [req.params.id, target_node_id, relation_type]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error("KNOWLEDGE RELATION:", e);
    res.status(500).json({ message: "Connection could not be created", error: e.message });
  }
};

exports.removeRelation = async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM knowledge_node_relations WHERE id=$1 AND (source_node_id=$2 OR target_node_id=$2) RETURNING id", [req.params.relationId, req.params.id]);
    if (!result.rowCount) return res.status(404).json({ message: "Connection not found" });
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ message: "Connection could not be removed", error: e.message });
  }
};

exports.attachItem = async (req, res) => {
  try {
    const { item_id, relation_type = "related" } = req.body;
    const result = await pool.query(`
      INSERT INTO knowledge_node_items(node_id,item_id,relation_type)
      VALUES($1,$2,$3) ON CONFLICT(node_id,item_id) DO UPDATE SET relation_type=EXCLUDED.relation_type
      RETURNING *
    `, [req.params.id, item_id, relation_type]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ message: "Item could not be attached", error: e.message });
  }
};

exports.listItems = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT i.id,i.title,i.status,i.priority,i.item_type,ni.relation_type
      FROM knowledge_node_items ni JOIN items i ON i.id=ni.item_id
      WHERE ni.node_id=$1 AND i.archived_at IS NULL ORDER BY i.updated_at DESC
    `, [req.params.id]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: "Scope items could not be loaded", error: e.message });
  }
};
