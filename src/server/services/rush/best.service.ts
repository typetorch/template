import { DataStoreService, Players } from "@rbxts/services";
import { Module, observePlayers, Service, TypeTorch, type OnInit, type OnStart, type OnStop } from "@typetorch/framework";
import { $print, $warn } from "rbxts-transform-debug";
import { SAVE_PERSONAL_BEST } from "../../../shared/rush/config";

/** Plain data in persist: survives hot-swaps, so a deploy never re-reads or loses a best. */
interface BestStore {
	/** userId -> best score known in this server (loaded, or set this session). */
	best: Map<number, number>;
	/** userId -> best score the DataStore is known to hold. best > saved means a write is due. */
	saved: Map<number, number>;
	/** The DataStore failed (e.g. Studio without API access): stay in-session only for this server. */
	failed: boolean;
}

const STORE_VERSION = "v1";

/**
 * Personal bests in a DataStore, kept small and safe:
 * - one key per player (`pb_<userId>`), in a store split by channel, so dev servers never touch prod bests;
 * - read once per join (skipped when an earlier generation already loaded it), written only when a round sets a new
 *   best (UpdateAsync keeps the max), always behind a budget check and pcall, never blocking gameplay;
 * - a write that was cut off by a hot-swap is retried by the next generation (best > saved in persist).
 * If the DataStore is unavailable (Studio without API access), bests stay in-session (persist) only.
 */
@Service()
export class BestService extends Module implements OnInit, OnStart, OnStop {
	private store!: BestStore;
	private dataStore?: DataStore;
	/** Per generation: loads and writes in flight (a swap ends them; persist says what is still due). */
	private readonly busy = new Set<number>();
	/** Set in onStop: player troves are also cleaned when the generation stops, which is not a player leaving. */
	private stopping = false;
	private readonly loadedListeners = new Set<(player: Player) => void>();

	onInit() {
		this.store = this.ctx.persist<BestStore>(`rush.best.${STORE_VERSION}`, () => ({
			best: new Map(),
			saved: new Map(),
			failed: false,
		}));
		if (this.offline()) return;
		const name = TypeTorch.channel === "prod" ? `TargetRush_${STORE_VERSION}` : `TargetRush_${STORE_VERSION}_${TypeTorch.channel}`;
		const [ok, result] = pcall(() => DataStoreService.GetDataStore(name));
		if (ok) this.dataStore = result;
		else this.goOffline(`GetDataStore failed: ${result}`);
	}

	onStart() {
		observePlayers(this.trove, (player, playerTrove) => {
			const userId = player.UserId;
			if (!this.store.best.has(userId)) playerTrove.add(task.spawn(() => this.load(userId)));
			else this.flush(userId);
			// Leaving: write what is due, then forget the player (another server may set a new best next).
			playerTrove.add(() => {
				if (this.stopping) return; // a hot-swap, not a leave: the next generation keeps going from persist
				this.busy.delete(userId); // a load cut off by the leave
				const best = this.store.best.get(userId) ?? 0;
				if (best > (this.store.saved.get(userId) ?? 0)) this.flush(userId);
				else {
					this.store.best.delete(userId);
					this.store.saved.delete(userId);
				}
			});
		});
	}

	onStop() {
		this.stopping = true;
	}

	/** Calls `listener` when a player's best finished loading. Returns a disconnect function. */
	onLoaded(listener: (player: Player) => void): () => void {
		this.loadedListeners.add(listener);
		return () => this.loadedListeners.delete(listener);
	}

	/** The player's best, 0 while it loads. */
	get(player: Player): number {
		return this.store.best.get(player.UserId) ?? 0;
	}

	/** Records a round score. True when it beat the personal best (the DataStore write runs in the background). */
	submit(player: Player, score: number): boolean {
		const userId = player.UserId;
		const best = this.store.best.get(userId) ?? 0;
		if (score <= best) return false;
		this.store.best.set(userId, score);
		this.flush(userId);
		return true;
	}

	/** The knob is read live, so a deploy can turn saving on or off; a failure sticks for this server. */
	private offline(): boolean {
		return !SAVE_PERSONAL_BEST || this.store.failed;
	}

	private goOffline(reason: string) {
		if (this.store.failed) return;
		this.store.failed = true;
		$warn(`personal bests stay in-session only: ${reason}`);
	}

	private load(userId: number) {
		const dataStore = this.dataStore;
		if (!dataStore || this.offline() || this.busy.has(userId)) {
			if (!this.store.best.has(userId)) this.store.best.set(userId, 0);
			return;
		}
		this.busy.add(userId);
		for (let attempt = 1; attempt <= 3; attempt++) {
			if (DataStoreService.GetRequestBudgetForRequestType(Enum.DataStoreRequestType.GetAsync) < 1) {
				task.wait(2);
				continue;
			}
			const [ok, value] = pcall(() => dataStore.GetAsync(`pb_${userId}`)[0]);
			if (ok) {
				const loaded = typeIs(value, "number") ? value : 0;
				// A best set this session (before the load finished) wins over the stored one.
				const current = this.store.best.get(userId) ?? 0;
				this.store.best.set(userId, math.max(loaded, current));
				this.store.saved.set(userId, loaded);
				this.busy.delete(userId);
				if (current > loaded) this.flush(userId);
				const player = Players.GetPlayerByUserId(userId);
				if (player && loaded > 0) for (const listener of [...this.loadedListeners]) task.spawn(listener, player);
				return;
			}
			if (attempt === 3) this.goOffline(`GetAsync failed: ${value}`);
			else task.wait(attempt * 2);
		}
		this.busy.delete(userId);
		if (!this.store.best.has(userId)) this.store.best.set(userId, 0);
	}

	/** Writes the best if it is ahead of the stored one. Never yields the caller. */
	private flush(userId: number) {
		const dataStore = this.dataStore;
		if (!dataStore || this.offline() || this.busy.has(userId)) return;
		const best = this.store.best.get(userId) ?? 0;
		if (best <= (this.store.saved.get(userId) ?? 0)) return;
		if (DataStoreService.GetRequestBudgetForRequestType(Enum.DataStoreRequestType.UpdateAsync) < 1) return; // next round
		this.busy.add(userId);
		this.trove.add(
			task.spawn(() => {
				const [ok, err] = pcall(() =>
					dataStore.UpdateAsync(`pb_${userId}`, (old: unknown) => {
						const stored = typeIs(old, "number") ? old : 0;
						return $tuple(math.max(stored, best), [userId]);
					}),
				);
				this.busy.delete(userId);
				if (ok) {
					this.store.saved.set(userId, best);
					$print(`saved personal best ${best} for ${userId}`);
				} else $warn(`personal best write failed (retried next round): ${err}`);
			}),
		);
	}
}
