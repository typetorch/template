import { Controller, Module, TypeTorch, type OnStart, type StartReason } from "@typetorch/framework";
import { PALETTE } from "../../../shared/rush/palette";
import { checkIcon, refreshIcon, spinnerIcon } from "../../../shared/ui/icons";
import { UiController, type Toast } from "../ui/ui.controller";

/** Survives the client's own hot-swap: when the "Updating" toast appeared, to show how long the update took. */
interface UpdateMemo {
	pendingAt: number;
}

const DONE_WORDS: Partial<Record<StartReason, string>> = {
	rollback: "Rolled back",
	server_rollback: "Rolled back",
	auto_rollback: "Rolled back",
	branch: "Branch",
	pin: "Pinned",
	reload: "Reloaded",
};

/** "a1b2c3d-1f2e3d" -> "a1b2c3d", with the deploy number when the kernel knows it. */
function shortId(): string {
	const artifact = TypeTorch.artifact;
	const [commit] = artifact.id.split("-");
	const id = commit !== undefined && commit !== "" ? commit : artifact.id;
	return artifact.seq !== undefined ? `#${artifact.seq} ${id}` : id;
}

/**
 * The hot-swap moment, for every player:
 * - `TypeTorch.onUpdatePending` (the server got a deploy): a small "Updating" toast with a spinner and the ETA;
 * - after the swap this client runs new code: `TypeTorch.startInfo` says it was a swap, so the new generation shows
 *   "Updated" with the new short artifact id (and how long it took, from a persist memo the old generation left).
 * The round keeps going underneath: nothing else on screen resets.
 */
@Controller()
export class UpdateToastController extends Module implements OnStart {
	private memo!: UpdateMemo;
	private pending?: Toast;
	private pendingEndsAt = 0;

	constructor(private readonly ui: UiController) {
		super();
	}

	onStart() {
		this.memo = this.ctx.persist<UpdateMemo>("system.update.v1", () => ({ pendingAt: 0 }));
		const start = TypeTorch.startInfo;
		if (start.kind === "swap") {
			const took = this.memo.pendingAt > 0 ? os.clock() - this.memo.pendingAt : undefined;
			this.memo.pendingAt = 0;
			const word = DONE_WORDS[start.reason] ?? "Updated";
			const detail = start.reason === "branch" ? TypeTorch.branch : shortId();
			this.ui.toast({
				icon: (parent) => checkIcon(parent, UDim2.fromScale(1, 1), PALETTE.mint),
				text: word,
				detail: took !== undefined && took < 120 ? `${detail}  ${string.format("%.1fs", took)}` : detail,
				color: PALETTE.mint,
				seconds: 5,
			});
		}

		this.trove.add(
			TypeTorch.onUpdatePending((update) => {
				if (update.cancelled) {
					this.memo.pendingAt = 0;
					this.pending?.close();
					this.pending = undefined;
					return;
				}
				if (this.memo.pendingAt === 0) this.memo.pendingAt = os.clock();
				// Public servers may announce twice (the second time with a shorter ETA): keep the latest.
				this.pendingEndsAt = os.clock() + update.eta;
				const rollback = update.reason === "rollback" || update.reason === "server_rollback" || update.reason === "auto_rollback";
				if (!this.pending) {
					this.pending = this.ui.toast({
						icon: (parent) =>
							rollback ? refreshIcon(parent, UDim2.fromScale(1, 1), PALETTE.lemon, 2.5) : spinnerIcon(parent, UDim2.fromScale(1, 1), PALETTE.lemon, 2.5),
						text: rollback ? "Rolling back" : "Updating",
						detail: "",
						color: PALETTE.lemon,
						seconds: update.eta + 30, // safety: the swap normally replaces this toast long before
					});
					const toast = this.pending;
					const spinner = toast.frame.FindFirstChild("Icon")?.FindFirstChild("SpinnerIcon")?.FindFirstChild("Ring") as
						| Frame
						| undefined;
					this.trove.add(
						task.spawn(() => {
							while (toast.frame.Parent !== undefined) {
								const left = math.max(this.pendingEndsAt - os.clock(), 0);
								toast.setDetail(left > 0.5 ? `~${math.ceil(left)}s` : "");
								if (spinner) spinner.Rotation = (os.clock() * 360) % 360;
								task.wait();
							}
							if (this.pending === toast) this.pending = undefined;
						}),
					);
				}
			}),
		);
	}
}
