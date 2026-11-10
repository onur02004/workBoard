const pool = require("../config/database");

function normaliseLinks(input) {
    if (!Array.isArray(input)) return null;
    if (input.length > 30) return null;

    const links = [];
    const seen = new Set();

    for (const entry of input) {
        if (!entry || typeof entry.url !== "string") continue;
        const rawUrl = entry.url.trim();
        if (!rawUrl) continue;

        let parsed;
        try { parsed = new URL(rawUrl); }
        catch { throw new Error(`Invalid URL: ${rawUrl}`); }

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error("Only HTTP and HTTPS links are allowed");
        }

        const url = parsed.toString();
        if (seen.has(url)) continue;
        seen.add(url);

        const title = typeof entry.title === "string" && entry.title.trim()
            ? entry.title.trim().slice(0, 100)
            : parsed.hostname;

        links.push({ title, url, position: links.length });
    }

    return links;
}

// GET /api/boards/:boardId/links
exports.getBoardLinks = async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, board_id, title, url, position, created_at, updated_at
             FROM board_links
             WHERE board_id = $1
             ORDER BY position ASC, created_at ASC`,
            [req.params.boardId]
        );
        res.json(result.rows);
    } catch (error) {
        console.error("GET BOARD LINKS ERROR:", error);
        res.status(500).json({ message: "Failed to fetch board links", error: error.message });
    }
};

// PUT /api/boards/:boardId/links - replace the board's ordered link collection
exports.replaceBoardLinks = async (req, res) => {
    let links;
    try {
        links = normaliseLinks(req.body?.links);
        if (!links) return res.status(400).json({ message: "links must be an array with at most 30 entries" });
    } catch (error) {
        return res.status(400).json({ message: error.message });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const board = await client.query("SELECT id FROM boards WHERE id = $1 FOR UPDATE", [req.params.boardId]);
        if (!board.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ message: "Board not found" });
        }

        await client.query("DELETE FROM board_links WHERE board_id = $1", [req.params.boardId]);
        const saved = [];
        for (const link of links) {
            const result = await client.query(
                `INSERT INTO board_links (board_id, title, url, position)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, board_id, title, url, position, created_at, updated_at`,
                [req.params.boardId, link.title, link.url, link.position]
            );
            saved.push(result.rows[0]);
        }

        await client.query("COMMIT");
        res.json(saved);
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("REPLACE BOARD LINKS ERROR:", error);
        res.status(500).json({ message: "Failed to save board links", error: error.message });
    } finally {
        client.release();
    }
};
