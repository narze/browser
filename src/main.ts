import { mount } from "svelte";
import App from "./App.svelte";
import CommandPalette from "./CommandPalette.svelte";
import Peek from "./Peek.svelte";
import QuickWindow from "./QuickWindow.svelte";
import "./style.css";

// The palette and the peek frame are transparent views above the pages.
const views = { "#palette": CommandPalette, "#peek": Peek, "#mini": QuickWindow };
const route = window.location.hash as keyof typeof views;
if (route === "#palette" || route === "#peek")
  document.documentElement.classList.add("palette-window");
if (route === "#mini") document.documentElement.classList.add("quick-window");

mount(views[route] ?? App, { target: document.getElementById("app")! });
