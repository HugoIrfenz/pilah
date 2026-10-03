import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pilahRouter from "./pilah";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pilahRouter);

export default router;
