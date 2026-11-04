import { createContext, useContext } from "react";

export const OverlayRoot = createContext<HTMLElement | null>(null);

export const useOverlayRoot = () => useContext(OverlayRoot) ?? document.body;
