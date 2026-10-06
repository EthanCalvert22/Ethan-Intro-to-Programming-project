import "./ui/styles.css";
import { startApp } from "./ui/app";

const root = document.getElementById("app");
if (root !== null) {
  startApp(root, window);
}
