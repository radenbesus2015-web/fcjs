import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import "@fontsource-variable/inter";
import "./style.css";
import "@tabler/icons-webfont/dist/tabler-icons.min.css";
import "vue-sonner/style.css";
import { setApiBase } from "./utils/api";
import { setWsBase, ws } from "./utils/ws";
import CONFIG from "./config";
import { motion } from "motion-v";

const app = createApp(App);
// Configure WS base and create a persistent root socket
setWsBase(CONFIG.WS_API);
const SockRoot = ws("", { autoReconnect: true, autoRelease: false });

setApiBase(CONFIG.HTTP_API);
// setWsBase already called above

app.provide("SockRoot", SockRoot);
app.provide("config", CONFIG);
app.use(router);
app.component("motion", motion);
app.mount("#app");
