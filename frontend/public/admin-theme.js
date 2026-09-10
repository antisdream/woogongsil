      (() => {
        let mode = 'light';
        try {
          mode = localStorage.getItem('wgsAdminThemeMode') === 'dark' ? 'dark' : 'light';
        } catch {
          // Hardened browser modes can block storage; light remains the safe default.
        }
        document.documentElement.classList.add(`wgs-theme-${mode}`);
        document.documentElement.setAttribute('data-wgs-theme', mode);
        document.body.classList.add(`wgs-theme-${mode}`);
        document.body.setAttribute('data-wgs-theme', mode);
        document.documentElement.style.colorScheme = mode;
      })();
