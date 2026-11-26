//
// Copyright Contributors to the MaterialX Project
// SPDX-License-Identifier: Apache-2.0
//

#include <JsMaterialX/VectorHelper.h>
#include <JsMaterialX/Helpers.h>

#include <MaterialXCore/Document.h>
#include <MaterialXCore/Element.h>
#include <MaterialXCore/Interface.h>
#include <MaterialXCore/Node.h>
#include <MaterialXCore/Definition.h>

#include <emscripten/bind.h>

#include <unordered_map>

namespace ems = emscripten;
namespace mx = MaterialX;

EMSCRIPTEN_BINDINGS(engine_materialx_core)
{
    ems::class_<mx::StringResolver>("StringResolver")
        .smart_ptr<std::shared_ptr<mx::StringResolver>>("StringResolver")
        .function("getFilenameSubstitutions", ems::optional_override([](mx::StringResolver& self) {
            const auto substitutions = self.getFilenameSubstitutions();
            ems::val result = ems::val::object();
            for (const auto& entry : substitutions)
            {
                result.set(entry.first, entry.second);
            }
            return result;
        }));

    ems::class_<mx::Element>("Element")
        .smart_ptr<std::shared_ptr<mx::Element>>("Element")
        .smart_ptr<std::shared_ptr<const mx::Element>>("Element")
        .function("getCategory", &mx::Element::getCategory)
        .function("getName", &mx::Element::getName)
        BIND_MEMBER_FUNC("getNamePath", mx::Element, getNamePath, 0, 1, mx::ConstElementPtr)
        .function("getAttribute", &mx::Element::getAttribute)
        .function("getColorSpace", &mx::Element::getColorSpace)
        .function("getActiveSourceUri", &mx::Element::getActiveSourceUri)
        .function("getParent", ems::select_overload<mx::ConstElementPtr() const>(&mx::Element::getParent))
        .function("validate", ems::optional_override([](mx::Element& self) {
            return self.validate();
        }))
        .function("createStringResolver", &mx::Element::createStringResolver);

    ems::class_<mx::TypedElement, ems::base<mx::Element>>("TypedElement")
        .smart_ptr<std::shared_ptr<mx::TypedElement>>("TypedElement")
        .smart_ptr<std::shared_ptr<const mx::TypedElement>>("TypedElement")
        .function("getType", &mx::TypedElement::getType);

    ems::class_<mx::ValueElement, ems::base<mx::TypedElement>>("ValueElement")
        .smart_ptr<std::shared_ptr<mx::ValueElement>>("ValueElement")
        .smart_ptr<std::shared_ptr<const mx::ValueElement>>("ValueElement")
        .function("getValueString", &mx::ValueElement::getValueString)
        .function("hasValue", &mx::ValueElement::hasValue)
        .function("getInterfaceName", &mx::ValueElement::getInterfaceName)
        .function("getUnit", &mx::ValueElement::getUnit)
        .function("getUnitType", &mx::ValueElement::getUnitType);

    ems::class_<mx::PortElement, ems::base<mx::ValueElement>>("PortElement")
        .smart_ptr<std::shared_ptr<mx::PortElement>>("PortElement")
        .smart_ptr<std::shared_ptr<const mx::PortElement>>("PortElement")
        .function("setNodeName", &mx::PortElement::setNodeName)
        .function("getNodeGraphString", &mx::PortElement::getNodeGraphString)
        .function("getOutputString", &mx::PortElement::getOutputString)
        .function("getConnectedNode", &mx::PortElement::getConnectedNode)
        .function("getConnectedOutput", &mx::PortElement::getConnectedOutput);

    ems::class_<mx::Input, ems::base<mx::PortElement>>("Input")
        .smart_ptr<std::shared_ptr<mx::Input>>("Input")
        .smart_ptr<std::shared_ptr<const mx::Input>>("Input")
        .function("getDefaultGeomPropString", &mx::Input::getDefaultGeomPropString)
        .function("getConnectedNode", &mx::Input::getConnectedNode)
        .function("getInterfaceInput", &mx::Input::getInterfaceInput);

    ems::class_<mx::Output, ems::base<mx::PortElement>>("Output")
        .smart_ptr<std::shared_ptr<mx::Output>>("Output")
        .smart_ptr<std::shared_ptr<const mx::Output>>("Output");

    ems::class_<mx::InterfaceElement, ems::base<mx::TypedElement>>("InterfaceElement")
        .smart_ptr<std::shared_ptr<mx::InterfaceElement>>("InterfaceElement")
        .smart_ptr<std::shared_ptr<const mx::InterfaceElement>>("InterfaceElement")
        .function("getInputs", &mx::InterfaceElement::getInputs)
        .function("getActiveInputs", &mx::InterfaceElement::getActiveInputs)
        .function("getOutputs", &mx::InterfaceElement::getOutputs)
        .function("getActiveOutputs", &mx::InterfaceElement::getActiveOutputs)
        .function("getActiveTokens", &mx::InterfaceElement::getActiveTokens)
        .function("getTarget", &mx::InterfaceElement::getTarget)
        .function("getVersionString", &mx::InterfaceElement::getVersionString);

    ems::class_<mx::Node, ems::base<mx::InterfaceElement>>("Node")
        .smart_ptr<std::shared_ptr<mx::Node>>("Node")
        .smart_ptr<std::shared_ptr<const mx::Node>>("Node")
        BIND_MEMBER_FUNC("getNodeDef", mx::Node, getNodeDef, 0, 1, stRef)
        .function("getDownstreamPorts", &mx::Node::getDownstreamPorts);

    ems::class_<mx::GraphElement, ems::base<mx::InterfaceElement>>("GraphElement")
        .smart_ptr<std::shared_ptr<mx::GraphElement>>("GraphElement")
        .smart_ptr<std::shared_ptr<const mx::GraphElement>>("GraphElement")
        .function("getMaterialNodes", &mx::GraphElement::getMaterialNodes);

    ems::class_<mx::NodeGraph, ems::base<mx::GraphElement>>("NodeGraph")
        .smart_ptr<std::shared_ptr<mx::NodeGraph>>("NodeGraph")
        .smart_ptr<std::shared_ptr<const mx::NodeGraph>>("NodeGraph")
        .function("getNodeDef", &mx::NodeGraph::getNodeDef);

    ems::class_<mx::NodeDef, ems::base<mx::InterfaceElement>>("NodeDef")
        .smart_ptr<std::shared_ptr<mx::NodeDef>>("NodeDef")
        .smart_ptr<std::shared_ptr<const mx::NodeDef>>("NodeDef")
        .function("getNodeString", &mx::NodeDef::getNodeString)
        .function("getNodeGroup", &mx::NodeDef::getNodeGroup)
        BIND_MEMBER_FUNC("getImplementation", mx::NodeDef, getImplementation, 0, 1, stRef);

    ems::class_<mx::Implementation, ems::base<mx::InterfaceElement>>("Implementation")
        .smart_ptr<std::shared_ptr<mx::Implementation>>("Implementation")
        .smart_ptr<std::shared_ptr<const mx::Implementation>>("Implementation")
        .function("getFile", &mx::Implementation::getFile)
        .function("getFunction", &mx::Implementation::getFunction);

    ems::class_<mx::Token, ems::base<mx::ValueElement>>("Token")
        .smart_ptr<std::shared_ptr<mx::Token>>("Token")
        .smart_ptr<std::shared_ptr<const mx::Token>>("Token");

    ems::class_<mx::Document, ems::base<mx::GraphElement>>("Document")
        .smart_ptr<std::shared_ptr<mx::Document>>("Document")
        .smart_ptr<std::shared_ptr<const mx::Document>>("Document")
        .function("importLibrary", &mx::Document::importLibrary)
        .function("getNodeDefs", &mx::Document::getNodeDefs);

    ems::function("createDocument", &mx::createDocument);
}
