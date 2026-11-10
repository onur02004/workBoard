
const express = require("express");
const router = express.Router();

const columnController = require("../controllers/columnController");

router.get("/", columnController.getColumns);
router.get("/:id", columnController.getColumnById);
router.post("/", columnController.createColumn);
router.patch("/:id", columnController.updateColumn);
router.delete("/:id", columnController.deleteColumn);

module.exports = router;
