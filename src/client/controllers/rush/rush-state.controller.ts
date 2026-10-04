import { atom } from "@rbxts/charm";
import { Workspace } from "@rbxts/services";
import { Controller, Module, type OnInit, type OnStart } from "@typetorch/framework";
import { $print, $warn } from "rbxts-transform-debug";
import { network } from "../../../shared/net";
import { COMBO_WINDOW } from "../../../shared/rush/config";
import {
	EMPTY_STATS,
	type BoardRow,
	type HitResult,
	type MyStats,
	type PersonalResult,
	type PhaseInfo,
	type RoundResults,
} from "../../../shared/rush/types";

export interface ResultsState {
	readonly results: RoundResults;
	readonly mine: PersonalResult;
}

/**
 * Client state for Target Rush, as charm atoms (the UI workflow: helpers draw from atoms, never from remote replies).
 * The server is the source of truth: events fill the atoms, and a snapshot fills them from scratch on join and after
 * this client's own hot-swap. The atoms belong to this controller instance, so each generation starts clean.
 */
@Controller({ loadOrder: -5 })
export class RushStateController extends Module implements OnInit, OnStart {
	readonly phase = atom<PhaseInfo>({ phase: "lobby", round: 0, startedAt: 0, endsAt: 0, swaps: 0 });
	readonly me = atom<MyStats>(EMPTY_STATS);
	readonly live = atom<BoardRow[]>([]);
	readonly session = atom<BoardRow[]>([]);
	readonly results = atom<ResultsState | undefined>(undefined);
	/** True once the first snapshot (or phase event) arrived. */
	readonly ready = atom(false);

	onInit() {
		this.trove.add(
			network.client.rush.phase.on((info) => {
				this.phase(info);
				this.ready(true);
				if (info.phase === "lobby" || info.phase === "countdown") this.results(undefined);
			}),
		);
		this.trove.add(network.client.rush.me.on((stats) => this.me(stats)));
		this.trove.add(
			network.client.rush.board.on((live, session) => {
				this.live(live);
				this.session(session);
			}),
		);
		this.trove.add(network.client.rush.results.on((results, mine) => this.results({ results, mine })));
	}

	onStart() {
		this.trove.add(task.spawn(() => this.loadSnapshot()));
	}

	/** Shows a confirmed hit at once (the server's `me` event follows with the same numbers). */
	applyHit(result: HitResult) {
		this.me((previous) => ({
			...previous,
			score: result.score,
			combo: result.combo,
			multiplier: result.multiplier,
			bestCombo: math.max(previous.bestCombo, result.combo),
			comboEndsAt: Workspace.GetServerTimeNow() + COMBO_WINDOW,
		}));
	}

	/** A whiff ends the combo (the server agrees and confirms with a `me` event). */
	breakCombo() {
		this.me((previous) => ({ ...previous, combo: 0, multiplier: 1, comboEndsAt: 0 }));
	}

	/** Retries: right after a hot-swap, the first request can race the server's own swap. */
	private loadSnapshot() {
		for (let attempt = 1; attempt <= 5; attempt++) {
			const [ok, reply] = pcall(() => network.client.rush.snapshot.invoke().expect());
			if (ok && reply[0] !== false) {
				const snapshot = reply[0];
				this.phase(snapshot.phase);
				this.me(snapshot.me);
				this.live(snapshot.live);
				this.session(snapshot.session);
				if (snapshot.results) this.results(snapshot.results);
				this.ready(true);
				$print(`snapshot: round ${snapshot.phase.round}, ${snapshot.phase.phase}, score ${snapshot.me.score}`);
				return;
			}
			$warn(`snapshot attempt ${attempt} failed: ${ok ? reply[1] : reply}`);
			task.wait(attempt);
		}
	}
}
