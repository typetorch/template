import { AnalyticsEngine, Controller, Module, type OnStart } from "@typetorch/framework";

/** The client half: device, screens, client tech health and the first-session recording go through the server. */
@Controller()
export class AnalyticsController extends Module implements OnStart {
	engine!: AnalyticsEngine;

	onStart() {
		this.engine = new AnalyticsEngine();
		this.engine.track("client_ready", { generation: this.ctx.generation });
	}
}
