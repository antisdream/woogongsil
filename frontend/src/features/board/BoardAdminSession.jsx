import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import AdminLogin from '../../admin/AdminLogin.jsx';
import { fetchAdminSession, makeAdminHeaders } from '../../admin/adminSession.js';
import { BoardAdminContext } from './boardAdminContext.js';
import './boardAdminSession.css';

export function BoardAdminSessionProvider({ children }) {
    const [authOpen, setAuthOpen] = useState(false);
    const pending = useRef([]);
    const dialog = useRef(null);
    const previousFocus = useRef(null);

    function finish(admin) {
        setAuthOpen(false);
        for (const resolve of pending.current.splice(0)) resolve(admin);
        previousFocus.current?.focus?.();
    }

    useEffect(() => () => { for (const resolve of pending.current.splice(0)) resolve(null); }, []);
    useEffect(() => { if (authOpen) dialog.current?.showModal(); }, [authOpen]);

    async function adminMutation(method, route, data) {
        let admin = await fetchAdminSession();
        if (!admin) {
            previousFocus.current = document.activeElement;
            admin = await new Promise(resolve => { pending.current.push(resolve); setAuthOpen(true); });
        }
        if (!admin?.isPrimaryAdmin) throw new Error('관리자 인증이 필요합니다.');
        return axios({ method, url: `/api/admin/board${route}`, data, withCredentials: true, headers: makeAdminHeaders() });
    }

    return <BoardAdminContext.Provider value={{ adminMutation }}>
        {children}
        {authOpen && <dialog ref={dialog} className="board-admin-auth-dialog" aria-label="게시판 관리자 인증" onCancel={event => { event.preventDefault(); finish(null); }}>
            <button type="button" className="board-button board-admin-auth-close" onClick={() => finish(null)}>취소</button>
            <AdminLogin onAuthenticated={finish} initialMessage="공지 관리 작업을 계속하려면 관리자 인증이 필요합니다." />
        </dialog>}
    </BoardAdminContext.Provider>;
}
