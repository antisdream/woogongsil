import { createContext, useContext } from 'react';

export const BoardAdminContext = createContext(null);
export const useBoardAdminSession = () => useContext(BoardAdminContext);
