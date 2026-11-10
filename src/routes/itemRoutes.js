const express = require("express");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");

const router = express.Router();
const itemController = require("../controllers/itemController");
const photoController = require("../controllers/itemPhotoController");
const extrasController = require("../controllers/itemExtrasController");

const uploadDirectory = path.resolve(process.cwd(), "uploads", "items");
fs.mkdirSync(uploadDirectory, { recursive: true });

const extensions = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif"
};

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, callback) => callback(null, uploadDirectory),
        filename: (_req, file, callback) => callback(null, `${randomUUID()}${extensions[file.mimetype] || ".img"}`)
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
        if (!extensions[file.mimetype]) {
            return callback(new Error("Only JPG, PNG, WEBP, GIF and AVIF images are allowed."));
        }
        callback(null, true);
    }
});

function uploadOnePhoto(req, res, next) {
    upload.single("photo")(req, res, (error) => {
        if (!error) return next();
        const message = error.code === "LIMIT_FILE_SIZE"
            ? "Photo must be 10 MB or smaller."
            : error.message || "Photo upload failed.";
        res.status(400).json({ message, code: error.code || "UPLOAD_ERROR" });
    });
}

router.get("/review/weekly", extrasController.weeklyReview);
router.get("/", itemController.getItems);
router.post("/", itemController.createItem);
router.get("/:id/subtasks", extrasController.getSubtasks);
router.post("/:id/subtasks", extrasController.createSubtask);
router.patch("/:id/subtasks/:subtaskId", extrasController.updateSubtask);
router.delete("/:id/subtasks/:subtaskId", extrasController.deleteSubtask);
router.get("/:id/relations", extrasController.getRelations);
router.post("/:id/relations", extrasController.createRelation);
router.delete("/:id/relations/:relationId", extrasController.deleteRelation);
router.get("/:id/photos", photoController.getItemPhotos);
router.post("/:id/photos", uploadOnePhoto, photoController.uploadItemPhoto);
router.delete("/:id/photos/:photoId", photoController.deleteItemPhoto);
router.get("/:id", itemController.getItemById);
router.patch("/:id", itemController.updateItem);
router.delete("/:id", itemController.deleteItem);

module.exports = router;
