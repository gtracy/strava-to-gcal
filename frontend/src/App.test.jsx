import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { describe, it, expect, vi } from 'vitest';

// Mock the Google OAuth hook
vi.mock('@react-oauth/google', () => ({
    useGoogleLogin: () => vi.fn(),
    GoogleOAuthProvider: ({ children }) => <div>{children}</div>
}));

describe('App', () => {
    it('renders without crashing', () => {
        render(
            <MemoryRouter>
                <App />
            </MemoryRouter>
        );
        expect(screen.getByText(/Continue with Google/i)).toBeInTheDocument();
    });
});
