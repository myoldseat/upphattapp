import React from 'react';
import { motion } from 'framer-motion';
import './App.css';

const App = () => {
  const handleWaitlistSubmit = async (event) => {
    event.preventDefault();
    const email = event.target.email.value;

    // Firebase Firestore integration to add email to the waitlist
    const db = firebase.firestore();
    await db.collection('waitlist').add({ email });
    alert('You have been added to the waitlist!');
  };

  return (
    <div className="app">
      {/* Hero Section */}
      <section className="hero glassmorphism">
        <h1>Welcome to UppHátt</h1>
        <form onSubmit={handleWaitlistSubmit}>
          <input type="email" name="email" required placeholder="Enter your email" />
          <button type="submit">Join the Waitlist</button>
        </form>
      </section>

      {/* Heatmap Section */}
      <section className="heatmap">
        <motion.div
          className="heatmap-animation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
        >
          <h2>Heatmap</h2>
          {/* Add heatmap visual here */}
        </motion.div>
      </section>
    </div>
  );
};

export default App;