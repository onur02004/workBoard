const express = require("express");
const router = express.Router();

const boardController = require("../controllers/boardController");
const boardLinkController = require("../controllers/boardLinkController");

router.get("/", boardController.getBoards);
router.get("/:id/links", (req, res, next) => {
    req.params.boardId = req.params.id;
    next();
}, boardLinkController.getBoardLinks);
router.put("/:id/links", (req, res, next) => {
    req.params.boardId = req.params.id;
    next();
}, boardLinkController.replaceBoardLinks);
router.get("/:id", boardController.getBoardById);
router.post("/", boardController.createBoard);
router.patch("/:id", boardController.updateBoard);
router.delete("/:id", boardController.deleteBoard);

module.exports = router;
