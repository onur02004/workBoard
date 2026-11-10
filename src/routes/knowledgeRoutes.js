const express = require("express");
const router = express.Router();
const controller = require("../controllers/knowledgeController");

router.get("/", controller.list);
router.post("/", controller.create);
router.patch("/:id", controller.update);
router.delete("/:id", controller.remove);
router.get("/:id/items", controller.listItems);
router.post("/:id/items", controller.attachItem);
router.post("/:id/relations", controller.addRelation);
router.delete("/:id/relations/:relationId", controller.removeRelation);

module.exports = router;
