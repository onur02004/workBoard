const pool = require("../config/database");
const fs = require("fs/promises");
const path = require("path");

const photoDirectory = path.resolve(process.cwd(), "uploads", "items");

async function removeStoredFile(storedName) {
    if (!storedName) return;
    try {
        await fs.unlink(path.join(photoDirectory, storedName));
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
}

exports.getItemPhotos = async (req, res) => {
    try {
        const item = await pool.query("SELECT id FROM items WHERE id = $1", [req.params.id]);
        if (!item.rows.length) return res.status(404).json({ message: "Item not found" });

        const result = await pool.query(
            `SELECT id, original_name, mime_type, size_bytes, created_at,
                    '/uploads/items/' || stored_name AS url
             FROM item_photos
             WHERE item_id = $1
             ORDER BY created_at ASC`,
            [req.params.id]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("GET ITEM PHOTOS ERROR:", error);
        res.status(500).json({ message: "Failed to fetch photos", error: error.message, code: error.code });
    }
};

exports.uploadItemPhoto = async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "Photo file is required" });

    try {
        const item = await pool.query("SELECT id FROM items WHERE id = $1", [req.params.id]);
        if (!item.rows.length) {
            await removeStoredFile(req.file.filename);
            return res.status(404).json({ message: "Item not found" });
        }

        const originalName = path.basename(req.file.originalname).replace(/[\r\n\0]/g, "_").slice(0, 255);
        const result = await pool.query(
            `INSERT INTO item_photos (item_id, original_name, stored_name, mime_type, size_bytes)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, original_name, mime_type, size_bytes, created_at`,
            [req.params.id, originalName, req.file.filename, req.file.mimetype, req.file.size]
        );

        res.status(201).json({
            ...result.rows[0],
            url: `/uploads/items/${req.file.filename}`
        });
    } catch (error) {
        await removeStoredFile(req.file.filename).catch(() => {});
        console.error("UPLOAD ITEM PHOTO ERROR:", error);
        res.status(500).json({ message: "Failed to upload photo", error: error.message, code: error.code });
    }
};

exports.deleteItemPhoto = async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM item_photos
             WHERE id = $1 AND item_id = $2
             RETURNING stored_name`,
            [req.params.photoId, req.params.id]
        );

        if (!result.rows.length) return res.status(404).json({ message: "Photo not found" });

        await removeStoredFile(result.rows[0].stored_name);
        res.json({ message: "Photo deleted successfully" });
    } catch (error) {
        console.error("DELETE ITEM PHOTO ERROR:", error);
        res.status(500).json({ message: "Failed to delete photo", error: error.message, code: error.code });
    }
};
