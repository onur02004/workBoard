const pool = require("../config/database");
const { removePhotoFiles } = require("../utils/itemPhotoFiles");

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// GET /api/boards
exports.getBoards = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.*,
                    COUNT(DISTINCT c.id)::int AS column_count,
                    COUNT(DISTINCT i.id)::int AS item_count
             FROM boards b
             LEFT JOIN columns c ON c.board_id = b.id
             LEFT JOIN items i ON i.column_id = c.id
             GROUP BY b.id
             ORDER BY b.position ASC, b.created_at ASC`
        );
        res.json(result.rows);
    } catch (error) {
        console.error("GET BOARDS ERROR:", error);
        res.status(500).json({ message: "Failed to fetch boards", error: error.message, code: error.code });
    }
};

// GET /api/boards/:id
exports.getBoardById = async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM boards WHERE id = $1", [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ message: "Board not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("GET BOARD ERROR:", error);
        res.status(500).json({ message: "Failed to fetch board", error: error.message, code: error.code });
    }
};

// POST /api/boards
exports.createBoard = async (req, res) => {
    try {
        const { title, description = null, url = null, color = "#4f86f7", properties = {} } = req.body;
        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ message: "Title is required" });
        }
        if (!isPlainObject(properties)) {
            return res.status(400).json({ message: "properties must be a JSON object" });
        }

        const result = await pool.query(
            `INSERT INTO boards (title, description, url, color, properties)
             VALUES ($1, $2, $3, $4, $5::jsonb)
             RETURNING *`,
            [title.trim(), description, url, color, JSON.stringify(properties)]
        );
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("CREATE BOARD ERROR:", error);
        res.status(500).json({ message: "Failed to create board", error: error.message, code: error.code });
    }
};

// PATCH /api/boards/:id
exports.updateBoard = async (req, res) => {
    try {
        const allowed = new Set(["title", "description", "url", "color", "position", "properties"]);
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
            `UPDATE boards SET ${assignments.join(", ")}
             WHERE id = $${values.length}
             RETURNING *`,
            values
        );
        if (!result.rows.length) return res.status(404).json({ message: "Board not found" });
        res.json(result.rows[0]);
    } catch (error) {
        console.error("UPDATE BOARD ERROR:", error);
        res.status(500).json({ message: "Failed to update board", error: error.message, code: error.code });
    }
};

// DELETE /api/boards/:id
exports.deleteBoard = async (req, res) => {
    try {
        const photos = await pool.query(
            `SELECT p.stored_name FROM item_photos p
             JOIN items i ON i.id = p.item_id
             JOIN columns c ON c.id = i.column_id
             WHERE c.board_id = $1`,
            [req.params.id]
        );
        const result = await pool.query("DELETE FROM boards WHERE id = $1 RETURNING id", [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ message: "Board not found" });
        await removePhotoFiles(photos.rows.map((row) => row.stored_name));
        res.json({ message: "Board deleted successfully" });
    } catch (error) {
        console.error("DELETE BOARD ERROR:", error);
        res.status(500).json({ message: "Failed to delete board", error: error.message, code: error.code });
    }
};
