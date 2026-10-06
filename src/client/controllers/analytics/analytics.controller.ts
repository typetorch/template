import { Players } from "@rbxts/services";
import type { Trove } from "@rbxts/trove";
import { AnalyticsEngine, Controller, Module, type AnalyticsProps, type OnInit } from "@typetorch/framework";
import {
	EVENTS,
	EXPERIMENTS,
	stepIndex,
	variantAttribute,
	type ExperimentName,
	type FunnelName,
	type FunnelStep,
	type Variant,
} from "../../../shared/analytics/catalog";

/** Survives this client's hot-swaps (a rejoin is a new session and starts empty). */
interface ClientMemo {
	/** Funnel steps and one-time events already sent this session. */
	sent: string[];
}

/**
 * The client half of analytics: device, screens (ScreenGuis and TTScreen-tagged frames, see client/ui/screens.ts),
 * client tech health and the first-session recording are automatic and go through the server, never to the internet.
 * Other controllers inject this one for the UI's own events (shop views, results closed, the onboarding guide) and
 * for their experiment variants, which the server assigns and hands over as player attributes.
 */
@Controller({ loadOrder: -20 })
export class AnalyticsController extends Module implements OnInit {
	engine!: AnalyticsEngine;
	private memo!: ClientMemo;

	onInit() {
		this.engine = new AnalyticsEngine();
		this.memo = this.ctx.persist<ClientMemo>("analytics.client.v1", () => ({ sent: [] }));
		this.engine.track(EVENTS.clientReady, { generation: this.ctx.generation });
	}

	/** The local player's variant: the server's choice (player attribute), the control until it arrives. */
	variant<E extends ExperimentName>(name: E): Variant<E> {
		const variants = EXPERIMENTS[name] as readonly string[];
		const value = Players.LocalPlayer.GetAttribute(variantAttribute(name));
		return (typeIs(value, "string") && variants.includes(value) ? value : variants[0]) as Variant<E>;
	}

	/** Calls `callback` with the variant now and again whenever the server changes it. */
	observeVariant<E extends ExperimentName>(trove: Trove, name: E, callback: (variant: Variant<E>) => void) {
		callback(this.variant(name));
		trove.connect(Players.LocalPlayer.GetAttributeChangedSignal(variantAttribute(name)), () => callback(this.variant(name)));
	}

	track(name: string, props?: AnalyticsProps) {
		this.engine.track(name, props);
	}

	/** A funnel step sent from the client, at most once per session. */
	step<F extends FunnelName>(funnel: F, step: FunnelStep<F>) {
		const index = stepIndex(funnel, step);
		if (this.once(`${funnel}:${index}`)) this.engine.step(funnel, index, step);
	}

	/** True the first time `key` is seen this session. */
	once(key: string): boolean {
		if (this.memo.sent.includes(key)) return false;
		this.memo.sent.push(key);
		return true;
	}
}
