const express = require("express");
const router = express.Router();
const controller = require("../controllers/linkPreviewController");

router.get("/", controller.getLinkPreview);

module.exports = router;
