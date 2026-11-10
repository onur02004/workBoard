const fs = require("fs/promises");
const path = require("path");

const photoDirectory = path.resolve(process.cwd(), "uploads", "items");

async function removePhotoFiles(storedNames) {
    await Promise.all((storedNames || []).map(async (storedName) => {
        try {
            await fs.unlink(path.join(photoDirectory, storedName));
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
    }));
}

module.exports = { removePhotoFiles };
