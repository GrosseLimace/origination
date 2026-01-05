// Theme management functions
window.themeManager = {
    // Get the current theme from localStorage
    getTheme: function() {
        return localStorage.getItem('theme') || 'light';
    },

    // Set the theme in localStorage and apply to document
    setTheme: function(theme) {
        localStorage.setItem('theme', theme);
        if (theme === 'dark') {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    },

    // Initialize theme on page load
    initTheme: function() {
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

        if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
            document.documentElement.classList.add('dark');
            return 'dark';
        } else {
            document.documentElement.classList.remove('dark');
            return 'light';
        }
    },

    // Toggle theme
    toggleTheme: function() {
        const isDark = document.documentElement.classList.contains('dark');
        const newTheme = isDark ? 'light' : 'dark';
        this.setTheme(newTheme);
        return newTheme;
    }
};

// Auto-initialize on script load
window.themeManager.initTheme();
