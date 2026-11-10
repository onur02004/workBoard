
const express = require("express");
const path = require("path");
require("dotenv").config();

const pool = require("./config/database");

const boardRoutes = require("./routes/boardRoutes");
const columnRoutes = require("./routes/columnRoutes");
const itemRoutes = require("./routes/itemRoutes");
const linkPreviewRoutes = require("./routes/linkPreviewRoutes");
const knowledgeRoutes = require("./routes/knowledgeRoutes");


const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "../public")));

// API Routes
app.use("/api/boards", boardRoutes);
app.use("/api/columns", columnRoutes);
app.use("/api/items", itemRoutes);
app.use("/api/link-preview", linkPreviewRoutes);
app.use("/api/knowledge", knowledgeRoutes);
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

// Health Check
app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");

        res.json({
            status: "online",
            database: "connected"
        });
    } catch (error) {
        console.error(error);

        res.status(500).json({
            status: "error",
            database: "disconnected"
        });
    }
});

const PORT = process.env.PORT || 3169;

app.listen(PORT, () => {
    console.log(`Workboard running at http://localhost:${PORT}`);
});
