const pool = require('../config/database');

exports.getSubtasks = async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM item_subtasks WHERE item_id=$1 ORDER BY position, created_at', [req.params.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not load subtasks' }); }
};
exports.createSubtask = async (req, res) => {
  try {
    const title = String(req.body.title || '').trim();
    if (!title) return res.status(400).json({ message: 'Subtask title is required' });
    const r = await pool.query('INSERT INTO item_subtasks(item_id,title,position) VALUES($1,$2,$3) RETURNING *', [req.params.id, title, Number.isInteger(req.body.position) ? req.body.position : 0]);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not create subtask' }); }
};
exports.updateSubtask = async (req, res) => {
  try {
    const fields = []; const values = [];
    if (typeof req.body.title === 'string') { values.push(req.body.title.trim()); fields.push(`title=$${values.length}`); }
    if (typeof req.body.is_completed === 'boolean') { values.push(req.body.is_completed); fields.push(`is_completed=$${values.length}`); }
    if (!fields.length) return res.status(400).json({ message: 'No changes supplied' });
    fields.push('updated_at=NOW()'); values.push(req.params.subtaskId, req.params.id);
    const r = await pool.query(`UPDATE item_subtasks SET ${fields.join(',')} WHERE id=$${values.length-1} AND item_id=$${values.length} RETURNING *`, values);
    if (!r.rows.length) return res.status(404).json({ message: 'Subtask not found' });
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not update subtask' }); }
};
exports.deleteSubtask = async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM item_subtasks WHERE id=$1 AND item_id=$2 RETURNING id', [req.params.subtaskId, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: 'Subtask not found' });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not delete subtask' }); }
};
exports.getRelations = async (req, res) => {
  try {
    const r = await pool.query(`SELECT ir.id, ir.relation_type, i.id AS related_item_id, i.title, i.item_type, i.status, c.title AS column_title
      FROM item_relations ir JOIN items i ON i.id=ir.related_item_id JOIN columns c ON c.id=i.column_id
      WHERE ir.item_id=$1 ORDER BY ir.created_at DESC`, [req.params.id]);
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not load related items' }); }
};
exports.createRelation = async (req, res) => {
  try {
    const relatedId = req.body.related_item_id;
    if (!relatedId || relatedId === req.params.id) return res.status(400).json({ message: 'Choose another item' });
    const r = await pool.query(`INSERT INTO item_relations(item_id,related_item_id,relation_type)
      VALUES($1,$2,$3) ON CONFLICT(item_id,related_item_id) DO UPDATE SET relation_type=EXCLUDED.relation_type
      RETURNING *`, [req.params.id, relatedId, req.body.relation_type || 'related']);
    res.status(201).json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not relate items' }); }
};
exports.deleteRelation = async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM item_relations WHERE id=$1 AND item_id=$2 RETURNING id', [req.params.relationId, req.params.id]);
    if (!r.rows.length) return res.status(404).json({ message: 'Relation not found' });
    res.json({ success: true });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not remove relation' }); }
};
exports.weeklyReview = async (_req, res) => {
  try {
    const r = await pool.query(`SELECT i.*, c.title AS column_title FROM items i JOIN columns c ON c.id=i.column_id
      WHERE i.archived_at IS NULL AND (i.completed_at >= date_trunc('week', CURRENT_DATE)
      OR (i.due_date < CURRENT_DATE AND i.status <> 'completed')) ORDER BY i.due_date NULLS LAST, i.updated_at DESC`);
    const completed = r.rows.filter(x => x.status === 'completed');
    const overdue = r.rows.filter(x => x.status !== 'completed' && x.due_date && new Date(x.due_date) < new Date(new Date().toDateString()));
    res.json({ completed, overdue, total_completed: completed.length, total_overdue: overdue.length, week_start: new Date().toISOString().slice(0,10) });
  } catch (e) { console.error(e); res.status(500).json({ message: 'Could not build weekly review' }); }
};
