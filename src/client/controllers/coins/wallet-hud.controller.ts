import { bump, Controller, Module, type OnStart } from "@typetorch/framework";
import { $warn } from "rbxts-transform-debug";
import { network } from "../../../shared/net";
import { PALETTE } from "../../../shared/rush/palette";
import { formatNumber } from "../../../shared/rush/rules";
import { coinIcon } from "../../../shared/ui/icons";
import { corner, FONT_TITLE, pad, panel, row, stroke, text } from "../../../shared/ui/kit";
import { UiController } from "../ui/ui.controller";

/** The coin counter (top right): a gold circle and a number that bumps on change. UiController is injected. */
@Controller()
export class WalletHudController extends Module implements OnStart {
	private total = -1;
	private counter?: Frame;
	private amount?: TextLabel;

	constructor(private readonly ui: UiController) {
		super();
	}

	onStart() {
		const counter = panel(this.ui.hud, "Coins", PALETTE.ink, {
			AnchorPoint: new Vector2(1, 0),
			Position: new UDim2(1, -10, 0, 8),
			Size: UDim2.fromOffset(0, 44),
			AutomaticSize: Enum.AutomaticSize.X,
			BackgroundTransparency: 0.15,
		});
		corner(counter);
		stroke(counter, PALETTE.gold, 2, 0.4);
		pad(counter, 8, 0).PaddingRight = new UDim(0, 14);
		const layout = row(counter, 8);
		layout.HorizontalAlignment = Enum.HorizontalAlignment.Right;
		coinIcon(counter, UDim2.fromOffset(30, 30)).LayoutOrder = 1;
		const amount = text(counter, "Amount", "0", 28, FONT_TITLE, PALETTE.white, { LayoutOrder: 2 });
		amount.Size = UDim2.fromOffset(0, 32);

		this.counter = counter;
		this.amount = amount;
		this.trove.add(network.client.coins.changed.on((total) => this.show(total)));
		this.trove.addPromise(
			network.client.coins.balance
				.invoke()
				.then((reply) => {
					const [value] = reply;
					if (typeIs(value, "number")) this.show(value);
				})
				.catch((err) => $warn(`balance failed: ${err}`)),
		);
	}

	private show(total: number) {
		if (total === this.total || !this.counter || !this.amount) return;
		const first = this.total === -1;
		this.total = total;
		this.amount.Text = formatNumber(total);
		if (!first) bump(this.counter);
	}
}
