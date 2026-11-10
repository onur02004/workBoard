const pool = require("../config/database");
const fs = require("fs/promises");
const path = require("path");

const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);
const STATUSES = new Set(["todo", "in_progress", "almost_done", "half_done", "completed", "failed", "on_hold", "done"]);
const photoDirectory = path.resolve(process.cwd(), "uploads", "items");

function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// GET /api/items
// Optional filters: ?column_id=UUID or ?board_id=UUID / ?board_id=null
exports.getItems = async (req, res) => {
    try {
        const values = [];
        const filters = [];

        if (req.query.column_id) {
            values.push(req.query.column_id);
            filters.push(`i.column_id = $${values.length}`);
        }

        if (req.query.view === "inbox") filters.push("i.is_inbox = TRUE");
        else if (req.query.view === "today") filters.push("i.due_date::date = CURRENT_DATE AND COALESCE(i.status, 'todo') <> 'completed'");
        else if (req.query.view === "upcoming") filters.push("i.due_date::date > CURRENT_DATE AND COALESCE(i.status, 'todo') <> 'completed' AND i.archived_at IS NULL");
        else if (req.query.view === "completed") filters.push("i.status = 'completed' AND i.archived_at IS NULL");
        else if (req.query.view === "archive") filters.push("i.archived_at IS NOT NULL");
        else if (req.query.view === "weekly") filters.push("(i.completed_at >= date_trunc('week', CURRENT_DATE) OR (i.due_date < CURRENT_DATE AND i.status <> 'completed')) AND i.archived_at IS NULL");
        else if (req.query.board_id === "null") filters.push("c.board_id IS NULL AND i.is_inbox = FALSE AND i.archived_at IS NULL");
        else if (req.query.board_id) {
            values.push(req.query.board_id);
            filters.push(`c.board_id = $${values.length} AND i.archived_at IS NULL AND i.is_inbox = FALSE`);
        } else filters.push("i.archived_at IS NULL AND i.is_inbox = FALSE");

        const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
        const result = await pool.query(
            `SELECT i.*, c.title AS column_title,
                    (SELECT COUNT(*)::int FROM item_photos p WHERE p.item_id = i.id) AS photo_count,
                    (SELECT COUNT(*)::int FROM item_subtasks st WHERE st.item_id = i.id) AS subtasks_total,
                    (SELECT COUNT(*)::int FROM item_subtasks st WHERE st.item_id = i.id AND st.is_completed = TRUE) AS subtasks_done,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'id', p.id,
                            'original_name', p.original_name,
                            'mime_type', p.mime_type,
                            'size_bytes', p.size_bytes,
                            'created_at', p.created_at,
                            'url', '/uploads/items/' || p.stored_name
                        ) ORDER BY p.created_at ASC)
                        FROM item_photos p WHERE p.item_id = i.id
                    ), '[]'::json) AS photos
             FROM items i
             JOIN columns c ON c.id = i.column_id
             ${where}
             ORDER BY c.position ASC, i.is_pinned DESC, i.position ASC, i.created_at ASC`,
            values
        );

        res.json(result.rows);
    } catch (error) {
        console.error("GET ITEMS ERROR:", error);
        res.status(500).json({ message: "Failed to fetch items", error: error.message, code: error.code });
    }
};

// GET /api/items/:id
exports.getItemById = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT i.*, c.title AS column_title,
                    COALESCE((
                        SELECT json_agg(json_build_object(
                            'id', p.id,
                            'original_name', p.original_name,
                            'mime_type', p.mime_type,
                            'size_bytes', p.size_bytes,
                            'created_at', p.created_at,
                            'url', '/uploads/items/' || p.stored_name
                        ) ORDER BY p.created_at ASC)
                        FROM item_photos p WHERE p.item_id = i.id
                    ), '[]'::json) AS photos
             FROM items i
             JOIN columns c ON c.id = i.column_id
             WHERE i.id = $1`,
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: "Item not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("GET ITEM ERROR:", error);
        res.status(500).json({ message: "Failed to fetch item", error: error.message, code: error.code });
    }
};

// POST /api/items
exports.createItem = async (req, res) => {
    try {
        const {
            column_id,
            title,
            description = null,
            priority = "normal",
            status = "todo",
            check_state = "empty",
            start_date = null,
            due_date = null,
            position = 0,
            item_type = "task",
            inbox = false,
            custom_values = {},
            properties = {},
            content_state = { collapsed_sections: {} }
        } = req.body;

        let targetColumnId = column_id;
        if (inbox === true || !targetColumnId) {
            const inboxColumn = await pool.query("SELECT id FROM columns WHERE system_key = 'inbox' LIMIT 1");
            if (!inboxColumn.rows.length) return res.status(500).json({ message: "Inbox column is missing. Run the Workboard productivity migration." });
            targetColumnId = inboxColumn.rows[0].id;
        }
        const allowedTypes = new Set(["task", "lecture", "exam", "project", "idea", "resource", "reminder"]);
        if (!allowedTypes.has(item_type)) return res.status(400).json({ message: "Invalid item_type" });
        if (typeof title !== "string" || !title.trim()) {
            return res.status(400).json({ message: "Title is required" });
        }
        if (!PRIORITIES.has(priority)) {
            return res.status(400).json({ message: "Invalid priority" });
        }
        if (!STATUSES.has(status)) {
            return res.status(400).json({ message: "Invalid status" });
        }
        if (!["empty", "checked", "partial"].includes(check_state)) {
            return res.status(400).json({ message: "Invalid check_state" });
        }
        if (!isPlainObject(custom_values) || !isPlainObject(properties) || !isPlainObject(content_state)) {
            return res.status(400).json({ message: "custom_values, properties and content_state must be JSON objects" });
        }

        const result = await pool.query(
            `INSERT INTO items
                (column_id, title, description, priority, status, check_state, start_date, due_date,
                 position, custom_values, properties, content_state, item_type, is_inbox, completed_at, is_pinned)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, FALSE)
             RETURNING *`,
            [
                targetColumnId,
                title.trim(),
                description,
                priority,
                status,
                check_state,
                start_date,
                due_date,
                Number.isInteger(position) ? position : 0,
                JSON.stringify(custom_values),
                JSON.stringify(properties),
                JSON.stringify(content_state),
                item_type,
                Boolean(inbox),
                status === "completed" ? new Date() : null
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error("CREATE ITEM ERROR:", error);
        res.status(500).json({ message: "Failed to create item", error: error.message, code: error.code });
    }
};

// PATCH /api/items/:id
// Only supplied fields are updated. Sending null clears nullable fields.
exports.updateItem = async (req, res) => {
    try {
        if (req.body.inbox === true) {
            const inboxColumn = await pool.query("SELECT id FROM columns WHERE system_key = 'inbox' LIMIT 1");
            if (!inboxColumn.rows.length) return res.status(500).json({ message: "Inbox column is missing. Run the Workboard productivity migration." });
            req.body.column_id = inboxColumn.rows[0].id;
            req.body.is_inbox = true;
        } else if (req.body.inbox === false && req.body.column_id) {
            req.body.is_inbox = false;
        }
        const allowed = new Set([
            "column_id", "title", "description", "priority", "status",
            "start_date", "due_date", "completed_at", "position", "check_state",
            "custom_values", "properties", "content_state", "item_type", "archived_at", "is_inbox", "is_pinned"
        ]);
        const jsonFields = new Set(["custom_values", "properties", "content_state"]);
        const assignments = [];
        const values = [];

        for (const [key, value] of Object.entries(req.body)) {
            if (!allowed.has(key)) continue;
            if (key === "title" && (typeof value !== "string" || !value.trim())) {
                return res.status(400).json({ message: "Title cannot be empty" });
            }
            if (key === "priority" && !PRIORITIES.has(value)) {
                return res.status(400).json({ message: "Invalid priority" });
            }
            if (key === "status" && !STATUSES.has(value)) {
                return res.status(400).json({ message: "Invalid status" });
            }
            if (key === "check_state" && !["empty", "checked", "partial"].includes(value)) {
                return res.status(400).json({ message: "Invalid check_state" });
            }
            if (key === "item_type" && !["task", "lecture", "exam", "project", "idea", "resource", "reminder"].includes(value)) {
                return res.status(400).json({ message: "Invalid item_type" });
            }
            if (key === "is_pinned" && typeof value !== "boolean") {
                return res.status(400).json({ message: "is_pinned must be a boolean" });
            }
            if (jsonFields.has(key) && !isPlainObject(value)) {
                return res.status(400).json({ message: `${key} must be a JSON object` });
            }

            values.push(jsonFields.has(key) ? JSON.stringify(value) : (key === "title" ? value.trim() : value));
            assignments.push(`${key} = $${values.length}${jsonFields.has(key) ? "::jsonb" : ""}`);
        }

        if (Object.prototype.hasOwnProperty.call(req.body, "status")) {
            values.push(req.body.status === "completed");
            assignments.push(`completed_at = CASE WHEN $${values.length} THEN COALESCE(completed_at, NOW()) ELSE NULL END`);
        }
        if (!assignments.length) {
            return res.status(400).json({ message: "No valid fields supplied" });
        }

        assignments.push("updated_at = NOW()");
        values.push(req.params.id);

        const result = await pool.query(
            `UPDATE items SET ${assignments.join(", ")}
             WHERE id = $${values.length}
             RETURNING *`,
            values
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: "Item not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error("UPDATE ITEM ERROR:", error);
        res.status(500).json({ message: "Failed to update item", error: error.message, code: error.code });
    }
};

// DELETE /api/items/:id
exports.deleteItem = async (req, res) => {
    try {
        const photos = await pool.query(
            "SELECT stored_name FROM item_photos WHERE item_id = $1",
            [req.params.id]
        );

        const result = await pool.query(
            "DELETE FROM items WHERE id = $1 RETURNING id",
            [req.params.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({ message: "Item not found" });
        }

        await Promise.all(photos.rows.map(({ stored_name }) =>
            fs.unlink(path.join(photoDirectory, stored_name)).catch((error) => {
                if (error.code !== "ENOENT") throw error;
            })
        ));

        res.json({ message: "Item deleted successfully" });
    } catch (error) {
        console.error("DELETE ITEM ERROR:", error);
        res.status(500).json({ message: "Failed to delete item", error: error.message, code: error.code });
    }
};
