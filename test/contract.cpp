#include <arisen/arisen.hpp>

using namespace arisen;

class[[arisen::contract]] hello : public contract
{
public:
  using contract::contract;

  [[arisen::action]] void hi(name user) {
    print("Hello, ", user);
  }
};
