import type { Sgp4WasmBackendMsgData } from './sgp4-wasm-backend-messages';

/** Pure-SGP4 builds never accept the optional wasm-backend control message. */
export const isSgp4WasmBackendMsg = (_data: unknown): _data is Sgp4WasmBackendMsgData => false;

/** Typed no-op counterpart to the enabled worker handler. */
export const handleSgp4WasmBackendMsg = (_data: Sgp4WasmBackendMsgData): void => undefined;
