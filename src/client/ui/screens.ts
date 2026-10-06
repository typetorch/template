import { CollectionService } from "@rbxts/services";
import { SCREEN_TAG } from "../../shared/analytics/catalog";

/**
 * Makes `gui` an analytics screen called `name` while it is Visible (framework: GuiObjects tagged `TTScreen`, named by a
 * `Name` attribute; the newest one open is the player's screen, the `screen:` part of their rows and a node of the
 * screen graph). Removing the tag or destroying `gui` closes the screen.
 *
 * Call it once `gui` is inside the PlayerGui: the framework only follows tagged elements that are already there.
 */
export function tagScreen(gui: GuiObject, name: string) {
	gui.SetAttribute("Name", name);
	CollectionService.AddTag(gui, SCREEN_TAG);
}
