import { PloneObject, PloneObjectOptions, Entry } from ".";

export default abstract class BaseFolder extends PloneObject {
	abstract entries: Map<string, Entry>;
	loadingEntries: boolean;
	loadingEntriesPromise: Promise<void>;
	loadedEntries: boolean;

	constructor(options: PloneObjectOptions) {
		super(options);

		this.loadingEntries = false;
		this.loadedEntries = false;
		this.loadingEntriesPromise = Promise.resolve();
	}

	loadEntries(): Promise<void> {
		if (this.loadingEntries) {
			return this.loadingEntriesPromise;
		}
		this.loadingEntries = true;
		return this.loadingEntriesPromise = this._loadEntries();
	}

	protected abstract async _loadEntries(): Promise<void>;
}