declare module 'mime/lite' {
	/**
	 * Get mime type for the given path or extension
	 * @param pathOrExtension 
	 * @returns null is returned in cases where an extension is not detected or recognized
	 */
	export function getType(pathOrExtension: string): string | null;
	/**
	 * Get extension for the given mime type. Charset options (often included in Content-Type headers) are ignored.
	 * @param mime
	 * @returns extension
	 */
	export function getExtension(type: string): string | null;
	/**
	 * Define [more] type mappings.
	 * @param typeMap map of type -> extensions
	 * @param force By default this method will throw an error if you try to map a type to an extension that is already assigned to another type. Passing true for the force argument will suppress this behavior (overriding any previous mapping).
	 */
	export function define(typeMap: { [type: string]: string[]; }, force?: boolean): void;
}

declare module 'ssl-root-cas' {
	export class RootCas extends Array<string> {
		rootCas: RootCas;
		addFile(filepath: string): RootCas;
	}
	export function create(): RootCas;
}