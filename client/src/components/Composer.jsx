import { useEffect, useRef, useState } from 'react';

export default function Composer({ onSend, disabled, hasProject }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  function submit(event) {
    event.preventDefault();
    const value = text.trim();
    if (!value || disabled) return;
    setText('');
    onSend(value);
  }

  return (
    <form className="composer" onSubmit={submit}>
      <label htmlFor="composer" className="sr-only">
        Message the agent
      </label>
      <textarea
        id="composer"
        ref={inputRef}
        rows={2}
        value={text}
        disabled={disabled}
        placeholder={hasProject ? 'Add a feature, fix something, or ask for a change…' : 'Describe the app you want built…'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit(event);
          }
        }}
      />
      <button type="submit" className="btn btn-primary" disabled={disabled || !text.trim()}>
        {disabled ? 'Running…' : 'Send'}
      </button>
    </form>
  );
}
