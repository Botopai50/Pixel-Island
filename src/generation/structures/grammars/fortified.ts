import {royalCastle} from './castle';
import {compactFortress} from './fortress';
import type {GrammarContext} from '../types';
export function fortress(c:GrammarContext){return compactFortress(c);}export function castle(c:GrammarContext){return royalCastle(c);}export function ruinedCastle(c:GrammarContext){return royalCastle(c);}
export {ancientRuins} from './ancientRuins';
export {ancientTemple as temple} from './temple';
