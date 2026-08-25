import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  create,
  getById,
  update,
  remove,
  list,
} from "../controllers/eventController.js";

const router = Router();

router.post("/", requireAuth, create);
router.get("/:id", requireAuth, getById);
router.patch("/:id", requireAuth, update);
router.delete("/:id", requireAuth, remove);
router.get("/", requireAuth, list);

export default router;
