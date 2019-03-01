import PloneObject from './PloneObject';
import Folder from './Folder';
import BaseFile from './BaseFile';
import Document from './Document';
import Page from './Page';
import NewsItem from './NewsItem';
import Event from './Event';
import Topic from './Topic';
import File from './File';
import LocalCss from './LocalCss';
import Portlet, { PortletSides, PortletUrls, PortletSideUrls, PortletManagerSides } from './Portlet';
import { Cookie } from '../../PloneFS';

export { PloneObject, Folder, BaseFile, Document, Page, NewsItem, Event, Topic, File, LocalCss, Portlet, PortletSides, PortletUrls, PortletSideUrls, PortletManagerSides };
export type Entry = Folder | BaseFile | Document;

export enum StateText {
	internal = 'Internal draft',
	external = 'Externally visible',
	internally_published = 'Internally published',
	internally_restricted = 'Internally restricted',
	private = 'Private',
	pending = 'Pending review',
};

export enum TextState {
	'Internal draft' = 'internal',
	'Externally visible' = 'external',
	'Internally published' = 'internally_published',
	'Internally restricted' = 'internally_restricted',
	'Private' = 'private',
	'Pending review' = 'pending',
};

export type State = keyof typeof StateText;

export interface WithState extends PloneObject {
	state: State;
}

export function isWithState(ploneObject: PloneObject): ploneObject is WithState {
	return Object.keys(StateText).includes((ploneObject as WithState).state);
}

export interface WithLocalCss extends PloneObject {
	hasLocalCss: boolean;
	localCss: LocalCss | undefined;
}

export function isWithLocalCss(ploneObject: PloneObject): ploneObject is WithLocalCss {
	return typeof (ploneObject as WithLocalCss).hasLocalCss === 'boolean';
}

export type Portlets = {
	top: Map<string, Portlet>,
	right: Map<string, Portlet>,
	bottom: Map<string, Portlet>,
	left: Map<string, Portlet>,
}

export interface WithPortlets extends PloneObject {
	portlets: Portlets;
	loadPortlets: (cookie: Cookie, side: keyof typeof PortletManagerSides) => Promise<boolean>;
}

export function isWithPortlets(ploneObject: PloneObject): ploneObject is WithPortlets {
	return typeof (ploneObject as WithPortlets).loadPortlets === 'function';
}