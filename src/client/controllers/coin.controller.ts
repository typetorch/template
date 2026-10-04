import { RunService } from "@rbxts/services";
import { Controller, Module, observeElement, type OnStart } from "@typetorch/framework";
import { network } from "../../shared/net";

/** Makes every live coin collectable: a highlight, a spin and a prompt, each in the coin's own trove. */
@Controller()
export class CoinController extends Module implements OnStart {
	onStart() {
		observeElement<BasePart>(this.trove, "Coin", (coin, coinTrove) => {
			if (!coin.IsA("BasePart")) return;
			const coinId = coin.GetAttribute("CoinId");
			if (!typeIs(coinId, "string")) return;

			const highlight = coinTrove.add(new Instance("Highlight"));
			highlight.FillColor = Color3.fromRGB(255, 214, 90);
			highlight.FillTransparency = 0.6;
			highlight.OutlineColor = Color3.fromRGB(255, 255, 255);
			highlight.Adornee = coin;
			highlight.Parent = coin;

			const prompt = coinTrove.add(new Instance("ProximityPrompt"));
			prompt.ActionText = "Collect";
			prompt.HoldDuration = 0;
			prompt.MaxActivationDistance = 12;
			prompt.RequiresLineOfSight = false;
			prompt.Parent = coin;
			coinTrove.connect(prompt.Triggered, () => network.client.coins.collect.fire(coinId));

			// A local-only spin: client changes to an anchored server part never replicate.
			const base = coin.CFrame;
			let angle = 0;
			coinTrove.connect(RunService.RenderStepped, (dt) => {
				angle += dt * 2;
				coin.CFrame = base.mul(CFrame.Angles(0, angle, 0));
			});
		});
	}
}
