# SigVol

### Signature-Calibrated Rough Volatility Options Market Maker

**SigVol** is a proprietary, client-side options risk dashboard and automated market-making terminal. It visualizes the execution of a non-Markovian stochastic control framework designed to manage Greeks inventory and extract volatility premium in real-time.

Legacy institutional algorithms price options as if equity markets are smooth, Markovian systems. This infrastructure invalidates that assumption. When structural liquidity breaks and volatility spikes, models relying on classical Brownian motion misprice the short-maturity skew and bleed capital through over-hedging. SigVol systematically exploits this by utilizing the Rough Bergomi (rBergomi) framework to model the fractional, self-exciting nature of microstructural order flow and its direct impact on the implied volatility surface.

---

### Mathematical & Engineering Architecture

#### 1. Surface Calibration (rBergomi)
The engine synthesizes a 3D Implied Volatility surface driven by live VIX/SPY spot dynamics. By employing fractional Brownian motion (H < 0.5), the system explicitly captures the power-law explosion of the short-maturity ATM skew ($T^{H-1/2}$) that standard Heston models fail to price.

#### 2. Path Signature Memory
Standard models have no memory. SigVol evaluates the non-Markovian state of the volatility surface by treating the path history of the underlying asset as a multidimensional tensor, utilizing truncated path signatures to predict regime transitions before they reflect in spot pricing.

#### 3. Friction-Adjusted Deep Hedging
The system abandons continuous Black-Scholes delta hedging. Instead, it evaluates a Conditional Value-at-Risk (CVaR) objective function. The terminal executes discrete delta-hedging blocks only when absolute structural risk limits are breached, preserving capital against microstructural transaction costs and bid-ask spread friction.

#### 4. The Execution Matrix
* **Risk Ledger:** Continuously computes Net Delta, Total Gamma, and Total Vega for a simulated short-volatility/gamma-scalping book.
* **Vol Surface:** Renders the rBergomi dynamics at 60 FPS via a custom, decoupled WebGL/Three.js engine, mapping volatility magnitude to a strict thermal color scale.
* **Routing Console:** Replaces raw execution logs with a compressed, high-signal feed displaying timestamp, localized price, and discrete routing status.

---

### Deployment

The execution interface runs entirely client-side, bypassing standard server latency via a pre-compiled JSON execution matrix simulating lock-free C11 atomic pointer logic.

**[Link to Live Terminal Deployment]**
