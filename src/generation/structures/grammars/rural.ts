import type {GrammarContext} from '../types';
export {farm} from './farm';
export {barn} from './barn';
export {stable} from './stable';
export {watchtower} from './watchtower';
import {watchtower} from './watchtower';
export function ruinedTower(c:GrammarContext){return watchtower(c);}
export {windmill} from './windmill';
