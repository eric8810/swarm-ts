import { hello } from "./index";

describe("hello function", () => {
  it("should return the correct greeting", () => {
    expect(hello()).toBe("Hello from swarm-ts!");
  });
});
