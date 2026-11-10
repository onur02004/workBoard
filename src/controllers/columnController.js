const pool = require("../config/database");
const { removePhotoFiles } = require("../utils/itemPhotoFiles");

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// GET /api/columns?board_id=UUID | ?board_id=null
exports.getColumns = async (req, res) => {
    try {
        const values = [];
        let where = "";

        if (req.query.board_id === "null") where = "WHERE c.board_id IS NULL AND c.system_key IS NULL";
        else if (req.query.board_id) { values.push(req.query.board_id); where = "WHERE c.board_id = $1 AND c.system_key IS NULL"; }
        else where = "WHERE c.system_key IS NULL";

        const result = await pool.query(
            `SELECT c.*, COUNT(i.id)::int AS item_count
             FROM columns c
             LEFT JOIN items i ON i.column_id = c.id
             ${where}
             GROUP BY c.id
             ORDER BY c.position ASC, c.created_at ASC`,
            values
        );

        res.json(result.rows);
    } catch (error) {
        console.error("GET COLUMNS ERROR:", error);
        res.status(500).json({ message: "Failed to fetch columns", error: error.message, code: error.code });
    }
};

// GET /api/columns/:id
exports.getColumnById = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM columns WHERE id = $1", [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ message: "Column not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("GET COLUMN ERROR:", error);
        res.status(500).json({ message: "Failed to fetch column", error: error.message, code: error.code });
    }
};

// POST /api/columns
exports.createColumn = async (req, res) => {
    try {
        const {
            board_id = null,
            title,
            description = null,
            url = null,
            color = "#5b8def",
            position = 0,
            properties = {}
        } = req.body;

        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ message: "Title is required" });
        }
        if (!isPlainObject(properties)) {
            return res.status(400).json({ message: "properties must be a JSON object" });
        }

        const result = await pool.query(
            `INSERT INTO columns (board_id, title, description, url, color, position, properties)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
             RETURNING *`,
            [board_id, title.trim(), description, url, color, Number.isInteger(position) ? position : 0, JSON.stringify(properties)]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("CREATE COLUMN ERROR:", error);
        res.status(500).json({ message: "Failed to create column", error: error.message, code: error.code });
    }
};

// PATCH /api/columns/:id
// Partial updates; explicit null clears nullable fields such as board_id or url.
exports.updateColumn = async (req, res) => {
    try {
        const allowed = new Set(["board_id", "title", "description", "url", "color", "position", "properties"]);
        const assignments = [];
        const values = [];

        for (const [key, value] of Object.entries(req.body)) {
            if (!allowed.has(key)) continue;
            if (key === "title" && (typeof value !== "string" || !value.trim())) {
                return res.status(400).json({ message: "Title cannot be empty" });
            }
            if (key === "properties" && !isPlainObject(value)) {
                return res.status(400).json({ message: "properties must be a JSON object" });
            }
            values.push(key === "properties" ? JSON.stringify(value) : (key === "title" ? value.trim() : value));
            assignments.push(`${key} = $${values.length}${key === "properties" ? "::jsonb" : ""}`);
        }

        if (!assignments.length) return res.status(400).json({ message: "No valid fields supplied" });
        assignments.push("updated_at = NOW()");
        values.push(req.params.id);

        const result = await pool.query(
            `UPDATE columns SET ${assignments.join(", ")}
             WHERE id = $${values.length}
             RETURNING *`,
            values
        );

        if (!result.rows.length) return res.status(404).json({ message: "Column not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("UPDATE COLUMN ERROR:", error);
        res.status(500).json({ message: "Failed to update column", error: error.message, code: error.code });
    }
};

// DELETE /api/columns/:id
exports.deleteColumn = async (req, res) => {
    try {
        const photos = await pool.query(
            `SELECT p.stored_name FROM item_photos p
             JOIN items i ON i.id = p.item_id
             WHERE i.column_id = $1`,
            [req.params.id]
        );
        const result = await pool.query("DELETE FROM columns WHERE id = $1 RETURNING id", [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ message: "Column not found" });
        await removePhotoFiles(photos.rows.map((row) => row.stored_name));
        res.json({ message: "Column deleted successfully" });
    } catch (error) {
        console.error("DELETE COLUMN ERROR:", error);
        res.status(500).json({ message: "Failed to delete column", error: error.message, code: error.code });
    }
};
