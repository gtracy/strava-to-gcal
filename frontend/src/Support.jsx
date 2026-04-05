import React, { useState } from 'react';
import axios from 'axios';
import { useGoogleReCaptcha } from 'react-google-recaptcha-v3';
import { Link } from 'react-router-dom';

const Support = ({ apiUrl }) => {
    const { executeRecaptcha } = useGoogleReCaptcha();
    const [formData, setFormData] = useState({
        email: '',
        subject: '',
        details: ''
    });
    const [status, setStatus] = useState({ type: '', message: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const faqs = [
        {
            q: "How long does it take for the activity to appear in Google Calendar?",
            a: "Activities usually appear within seconds of being uploaded to Strava. In some cases, it may take up to a minute depending on Strava's system load."
        },
        {
            q: "Does the service make edits and deletes in my Calendar when I make changes to activities in Strava?",
            a: "Yes! Updates to existing activities or deletions in Strava are reflected in your Google Calendar."
        },
        {
            q: "How far back in time will you sync data?",
            a: "When you first connect, we automatically sync your most recent activities (last 30 days). Ongoing sync only processes new activities as they happen."
        },
        {
            q: "How do I disconnect?",
            a: "You can disconnect at any time from the main dashboard by clicking 'Disconnect all services'. This will revoke all OAuth tokens and stop any background synchronization."
        },
        {
            q: "What data of mine is stored in your backend?",
            a: "We do not store your activity data (GPS traces, heart rate, etc.). We only store your encrypted Strava and Google access tokens required to perform the sync, and your preferred calendar ID."
        }
    ];

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!executeRecaptcha) {
            console.warn('Execute recaptcha not yet available');
            return;
        }

        setIsSubmitting(true);
        setStatus({ type: '', message: '' });

        try {
            const token = await executeRecaptcha('support_form');
            await axios.post(`${apiUrl}/support/contact`, {
                ...formData,
                captchaToken: token
            });
            setStatus({ type: 'success', message: 'Thank you! Your message has been sent.' });
            setFormData({ email: '', subject: '', details: '' });
        } catch (err) {
            setStatus({ type: 'error', message: err.response?.data?.error || 'Failed to send message. Please try again later.' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    return (
        <div className="support-container fade-in-up">
            <header style={{ marginBottom: '3rem', textAlign: 'left' }}>
                <Link to="/" className="btn-text" style={{ marginBottom: '1rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', opacity: 0.8 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                    Back to Dashboard
                </Link>
                <h1 className="title" style={{ fontSize: '2.5rem', marginTop: '0.5rem' }}>Support & <span className="highlight-text">FAQ</span></h1>
                <p className="status-desc" style={{ fontSize: '1.1rem' }}>Everything you need to know about Clocking Sweat.</p>
            </header>

            <section className="faq-section" style={{ marginBottom: '4rem' }}>
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        {faqs.map((faq, i) => (
                            <div key={i} className="faq-item">
                                <h3 style={{ color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '1.2rem' }}>{faq.q}</h3>
                                <p style={{ color: 'var(--text-secondary)', lineHeight: '1.6' }}>{faq.a}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="contact-section" style={{ alignItems: 'flex-start' }}>
                <h2 className="title" style={{ fontSize: '2rem', marginBottom: '1.5rem', textAlign: 'left' }}>Still have <span className="highlight-text">questions?</span></h2>
                <div className="glass-panel" style={{ padding: '2.5rem', width: '100%', boxSizing: 'border-box' }}>
                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div className="form-group">
                            <label htmlFor="email" className="status-title" style={{ display: 'block', marginBottom: '0.5rem' }}>Email Address</label>
                            <input
                                type="email"
                                id="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                required
                                className="custom-input"
                                style={{ width: '100%', padding: '0.8rem' }}
                                placeholder="name@example.com"
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="subject" className="status-title" style={{ display: 'block', marginBottom: '0.5rem' }}>Subject</label>
                            <input
                                type="text"
                                id="subject"
                                name="subject"
                                value={formData.subject}
                                onChange={handleChange}
                                required
                                className="custom-input"
                                style={{ width: '100%', padding: '0.8rem' }}
                                placeholder="How can we help?"
                            />
                        </div>
                        <div className="form-group">
                            <label htmlFor="details" className="status-title" style={{ display: 'block', marginBottom: '0.5rem' }}>Details</label>
                            <textarea
                                id="details"
                                name="details"
                                value={formData.details}
                                onChange={handleChange}
                                required
                                className="custom-input"
                                style={{ width: '100%', padding: '0.8rem', minHeight: '150px', resize: 'vertical' }}
                                placeholder="Tell us more about your issue..."
                            />
                        </div>

                        {status.message && (
                            <div className={`alert ${status.type === 'success' ? 'alert-success' : 'alert-error'}`}>
                                {status.message}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn btn-strava"
                            style={{ width: '100%', padding: '1rem', fontSize: '1.1rem' }}
                        >
                            {isSubmitting ? 'Sending...' : 'Send Message'}
                        </button>
                        <p style={{ 
                            fontSize: '0.75rem', 
                            color: 'var(--text-muted)', 
                            textAlign: 'center', 
                            marginTop: '1rem',
                            lineHeight: '1.4'
                        }}>
                            This site is protected by reCAPTCHA and the Google <a href="https://policies.google.com/privacy" className="btn-text" style={{ fontSize: '0.75rem', textDecoration: 'underline' }}>Privacy Policy</a> and <a href="https://policies.google.com/terms" className="btn-text" style={{ fontSize: '0.75rem', textDecoration: 'underline' }}>Terms of Service</a> apply.
                        </p>
                    </form>
                </div>
            </section>
        </div>
    );
};

export default Support;
