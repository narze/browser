import { mount } from "svelte";
import App from "./App.svelte";
import CommandPalette from "./CommandPalette.svelte";
import "./style.css";

const isPalette = window.location.hash === "#palette";
if (isPalette) document.documentElement.classList.add("palette-window");

mount(isPalette ? CommandPalette : App, { target: document.getElementById("app")! });
