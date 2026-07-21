import { Router } from "express";
import {
  authMiddleware,
  requireActiveAccess,
} from "../middlewares/auth.middleware";
import * as controller from "../controllers/memberAcademy.controller";
import * as assetController from "../controllers/cloudinaryAsset.controller";

const router = Router();
router.use(authMiddleware, requireActiveAccess);

router.get("/courses", controller.listCourses);
router.get("/courses/:identifier", controller.getCourse);
router.get("/courses/:id/progress", controller.getCourseProgress);
router.get("/lessons/:id", controller.getLesson);
router.put("/lessons/:id/progress", controller.updateProgress);

router.get("/calendar", controller.listCalendar);
router.get("/calendar/:id", controller.getCalendar);
router.get("/recipes", controller.listRecipes);
router.get("/recipes/:identifier", controller.getRecipe);
router.get("/achievements", controller.listAchievements);
router.get("/achievements/:id", controller.getAchievement);

router.get("/lessons/:lessonId/comments", controller.listComments);
router.post("/lessons/:lessonId/comments", controller.createComment);
router.put("/comments/:id", controller.updateComment);
router.delete("/comments/:id", controller.deleteComment);

router.post("/assets/delivery-url", assetController.deliveryUrl);

router.get("/recorded-classes", controller.listRecordedClasses);
router.get("/recorded-classes/:id", controller.getRecordedClass);

export default router;
