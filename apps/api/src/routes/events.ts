import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  create,
  getById,
  update,
  remove,
} from "../controllers/eventController.js";

const router = Router();

router.post("/", requireAuth, create);
router.get("/:id", requireAuth, getById);
router.patch("/:id", requireAuth, update);

router.delete("/:id", requireAuth, remove);

export default router;
