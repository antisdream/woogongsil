// Practical-exam feature module for IpepSettingLines.
import React from 'react';

function WgsIpepSettingLines({ text }) {
    return String(text || '')
        .split(/\r?\n|<br\s*\/?>/i)
        .map((line, index) => (
            <React.Fragment key={`${index}-${line}`}>
                {index >0 ? <br /> : null}
                {line}
            </React.Fragment>
        ));
}

export default WgsIpepSettingLines;
