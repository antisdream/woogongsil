export function memberRequestHeaders() {
    return {
        'X-User-Id': sessionStorage.getItem('userId') || '',
        'X-Session-Token': sessionStorage.getItem('sessionToken') || '',
        'X-Server-Instance-Id': sessionStorage.getItem('wgsServerInstanceId') || '',
    };
}
