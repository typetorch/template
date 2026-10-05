import { AnalyticsEngine, Module, Service, type OnInit, type OnPlayerAdded } from "@typetorch/framework";

/**
 * Analytics (framework README "Analytics"): joins, tech health, zones and new players' first sessions are automatic.
 * The sink comes from the ConfigService key TypeTorchAnalytics; without it the engine keeps only the newest rows.
 * Other services inject this one and call `this.analytics.engine.track(player, ...)`.
 */
@Service()
export class AnalyticsService extends Module implements OnInit, OnPlayerAdded {
	engine!: AnalyticsEngine;

	onInit() {
		this.engine = new AnalyticsEngine();
		this.engine.state("lobby");
	}

	onPlayerAdded(player: Player) {
		this.engine.step(player, "onboarding", 1, "joined");
		const hint = this.engine.experiment(player, "lobby_hint", ["arrow", "none"]);
		player.SetAttribute("LobbyHint", hint);
	}
}
