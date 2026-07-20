import { Router } from "express";
import { adminMiddleware } from "../middlewares/admin.middleware";
import { authMiddleware } from "../middlewares/auth.middleware";
import { upload } from "../middlewares/upload.middleware";
import * as adminController from "../controllers/admin.controller";
import * as manualPaymentController from "../controllers/manualPayment.controller";
import * as academyController from "../controllers/adminAcademy.controller";
import * as assetController from "../controllers/cloudinaryAsset.controller";
import * as bunnyController from "../controllers/bunnyStream.controller";

const router = Router();

router.use(authMiddleware, adminMiddleware);

router.get("/users", adminController.listUsers);
router.post("/users", adminController.createUser);
router.delete("/users/:id", adminController.deleteUser);
router.put("/users/:id/access", adminController.updateAccess);
router.put("/users/:id/founding-member", adminController.setFoundingMember);

router.get("/payments", manualPaymentController.list);
router.post(
  "/payments",
  upload.single("receipt"),
  manualPaymentController.create,
);
router.delete("/payments/:id", manualPaymentController.remove);

router.get("/courses", academyController.listCourses);
router.post("/courses", academyController.createCourse);
router.put("/courses/reorder", academyController.reorderCourses);
router.get("/courses/:id", academyController.getCourse);
router.put("/courses/:id", academyController.updateCourse);
router.delete("/courses/:id", academyController.deleteCourse);
router.get("/courses/:courseId/lessons", academyController.listLessons);
router.post("/courses/:courseId/lessons", academyController.createLesson);
router.put(
  "/courses/:courseId/lessons/reorder",
  academyController.reorderLessons,
);
router.get("/lessons/:id", academyController.getLesson);
router.put("/lessons/:id", academyController.updateLesson);
router.delete("/lessons/:id", academyController.deleteLesson);

router.get("/calendar/config", academyController.calendarConfig);
router.get("/calendar", academyController.listCalendar);
router.post("/calendar", academyController.createCalendar);
router.get("/calendar/:id", academyController.getCalendar);
router.put("/calendar/:id", academyController.updateCalendar);
router.delete("/calendar/:id", academyController.deleteCalendar);

router.get("/recipes", academyController.listRecipes);
router.post("/recipes", academyController.createRecipe);
router.get("/recipes/:id", academyController.getRecipe);
router.put("/recipes/:id", academyController.updateRecipe);
router.delete("/recipes/:id", academyController.deleteRecipe);

router.get("/achievements", academyController.listAchievements);
router.post("/achievements", academyController.createAchievement);
router.get("/achievements/:id", academyController.getAchievement);
router.put("/achievements/:id", academyController.updateAchievement);
router.delete("/achievements/:id", academyController.deleteAchievement);
router.post("/achievements/:id/award", academyController.awardAchievement);
router.delete(
  "/achievements/:id/award/:userId",
  academyController.revokeAchievement,
);

router.get("/comments", academyController.listComments);
router.put("/comments/:id/moderate", academyController.moderateComment);
router.delete("/comments/:id", academyController.deleteComment);

router.post("/assets/signature", assetController.signature);
router.post("/assets/confirm", assetController.confirm);
router.delete("/assets", assetController.remove);
router.post("/videos", bunnyController.createUpload);
router.post("/videos/:id/confirm", bunnyController.confirm);
router.get("/videos/:id", bunnyController.status);

export default router;
