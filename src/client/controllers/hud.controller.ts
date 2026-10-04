import { Players } from "@rbxts/services";
import { bump, Controller, Module, type OnInit, type OnStart } from "@typetorch/framework";
import { $print, $warn } from "rbxts-transform-debug";
import { BUILD } from "../../shared/build";
import { network } from "../../shared/net";

const GOLD = Color3.fromRGB(255, 196, 46);

function make<T extends keyof CreatableInstances>(className: T, parent: Instance, setup: (instance: CreatableInstances[T]) => void) {
	const instance = new Instance(className);
	setup(instance);
	instance.Parent = parent;
	return instance;
}

/** The HUD, built in code: a coin counter that bumps on change, and a tiny build stamp. */
@Controller()
export class HudController extends Module implements OnInit, OnStart {
	private total = -1;
	private counter?: Frame;
	private amount?: TextLabel;

	onInit() {
		$print(`client ${BUILD.branch}@${BUILD.commit} (generation ${this.ctx.generation})`);
	}

	onStart() {
		const gui = this.trove.add(new Instance("ScreenGui"));
		gui.Name = "Hud";
		gui.ResetOnSpawn = false;

		const counter = make("Frame", gui, (frame) => {
			frame.Name = "Coins";
			frame.AnchorPoint = new Vector2(0.5, 0);
			frame.Position = new UDim2(0.5, 0, 0, 8);
			frame.Size = UDim2.fromOffset(0, 52);
			frame.AutomaticSize = Enum.AutomaticSize.X;
			frame.BackgroundColor3 = Color3.fromRGB(20, 22, 28);
			frame.BackgroundTransparency = 0.2;
		});
		make("UICorner", counter, (corner) => (corner.CornerRadius = new UDim(1, 0)));
		make("UIPadding", counter, (padding) => {
			padding.PaddingLeft = new UDim(0, 10);
			padding.PaddingRight = new UDim(0, 18);
		});
		make("UIListLayout", counter, (layout) => {
			layout.FillDirection = Enum.FillDirection.Horizontal;
			layout.VerticalAlignment = Enum.VerticalAlignment.Center;
			layout.SortOrder = Enum.SortOrder.LayoutOrder;
			layout.Padding = new UDim(0, 10);
		});

		// The coin icon is a gold circle: no emoji, no text.
		const icon = make("Frame", counter, (frame) => {
			frame.Name = "Icon";
			frame.Size = UDim2.fromOffset(34, 34);
			frame.BackgroundColor3 = GOLD;
			frame.LayoutOrder = 1;
		});
		make("UICorner", icon, (corner) => (corner.CornerRadius = new UDim(1, 0)));
		make("UIStroke", icon, (stroke) => {
			stroke.Color = Color3.fromRGB(196, 132, 20);
			stroke.Thickness = 3;
		});
		make("UIAspectRatioConstraint", icon, (ratio) => (ratio.AspectRatio = 1));

		const amount = make("TextLabel", counter, (label) => {
			label.Name = "Amount";
			label.BackgroundTransparency = 1;
			label.Size = UDim2.fromOffset(0, 40);
			label.AutomaticSize = Enum.AutomaticSize.X;
			label.Font = Enum.Font.BuilderSansBold;
			label.TextSize = 30;
			label.TextColor3 = Color3.fromRGB(255, 255, 255);
			label.Text = "0";
			label.LayoutOrder = 2;
		});

		make("TextLabel", gui, (label) => {
			label.Name = "Build";
			label.BackgroundTransparency = 1;
			label.AnchorPoint = new Vector2(0, 1);
			label.Position = new UDim2(0, 8, 1, -6);
			label.Size = UDim2.fromOffset(0, 18);
			label.AutomaticSize = Enum.AutomaticSize.X;
			label.Font = Enum.Font.Code;
			label.TextSize = 14;
			label.TextColor3 = Color3.fromRGB(255, 255, 255);
			label.TextTransparency = 0.45;
			const commit = BUILD.commit !== undefined && BUILD.commit !== "" ? BUILD.commit : "uncommitted";
			label.Text = `${commit}${BUILD.dirty ? "*" : ""}`;
		});

		this.counter = counter;
		this.amount = amount;
		gui.Parent = Players.LocalPlayer.WaitForChild("PlayerGui");

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
		this.amount.Text = tostring(total);
		if (!first) bump(this.counter);
	}
}
