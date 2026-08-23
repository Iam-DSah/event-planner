import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { create, getById } from "../controllers/eventController.js";

const router = Router();

router.post("/", requireAuth, create,);
router.get("/:id", requireAuth, getById);

export default router;